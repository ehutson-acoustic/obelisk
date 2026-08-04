//! Claiming the system's default Markdown editor binding (DESIGN §10.2).
//!
//! Declaring the file association (§10.1) only gets Obelisk *offered*. Which
//! handler actually wins is a per-user preference held in the OS's own database,
//! and the two platforms agree on nothing about how it is read or written — hence
//! a thin module each behind one two-function interface.

use serde::Serialize;

/// What the settings row renders.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct DefaultEditorState {
    /// Whether this platform can be asked at all.
    pub supported: bool,
    /// Obelisk currently holds the binding.
    pub default: bool,
    /// What holds it instead — a bundle identifier on macOS, a desktop entry on
    /// Linux — or `None` when nothing does.
    pub current: Option<String>,
    /// Why claiming it cannot work right now, for the row's subtitle. `None`
    /// means the button is safe to press.
    pub blocked: Option<String>,
}

pub fn state(bundle_id: &str) -> DefaultEditorState {
    platform::state(bundle_id)
}

pub fn make_default(bundle_id: &str) -> Result<(), String> {
    platform::make_default(bundle_id)
}

#[cfg(target_os = "macos")]
mod platform {
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};

    use super::DefaultEditorState;

    /// The type macOS resolves `.md` and `.markdown` to. The binding is per
    /// content type rather than per extension, which is also why `.mdx` cannot be
    /// included — it has no registered type to bind (DESIGN §10.1).
    const MARKDOWN_UTI: &str = "net.daringfireball.markdown";

    /// `kLSRolesAll`, from `LSConstants.h`.
    const LS_ROLES_ALL: u32 = 0xFFFF_FFFF;

    // The Objective-C replacement — `-[NSWorkspace
    // setDefaultApplicationAtURL:toOpenContentType:completionHandler:]` — is
    // macOS 12+ and asynchronous, so it would cost an Objective-C bridge, a
    // block, and the app's 10.15 floor to make two calls. The SDK still marks
    // these `API_TO_BE_DEPRECATED`: flagged, with no removal version.
    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn LSCopyDefaultRoleHandlerForContentType(
            content_type: CFStringRef,
            role: u32,
        ) -> CFStringRef;

        fn LSSetDefaultRoleHandlerForContentType(
            content_type: CFStringRef,
            role: u32,
            handler: CFStringRef,
        ) -> i32;
    }

    fn current_handler() -> Option<String> {
        let uti = CFString::new(MARKDOWN_UTI);
        let handler = unsafe {
            LSCopyDefaultRoleHandlerForContentType(uti.as_concrete_TypeRef(), LS_ROLES_ALL)
        };
        if handler.is_null() {
            return None;
        }
        // A `Copy` function returns +1, so the string is ours to release; the
        // create rule is what hands that obligation to `CFString`'s `Drop`.
        Some(unsafe { CFString::wrap_under_create_rule(handler) }.to_string())
    }

    pub fn state(bundle_id: &str) -> DefaultEditorState {
        let current = current_handler();
        DefaultEditorState {
            supported: true,
            // LaunchServices compares identifiers case-insensitively and does not
            // preserve the case it was handed, so neither can we.
            default: current
                .as_deref()
                .is_some_and(|id| id.eq_ignore_ascii_case(bundle_id)),
            current,
            blocked: None,
        }
    }

    pub fn make_default(bundle_id: &str) -> Result<(), String> {
        let uti = CFString::new(MARKDOWN_UTI);
        let handler = CFString::new(bundle_id);
        let status = unsafe {
            LSSetDefaultRoleHandlerForContentType(
                uti.as_concrete_TypeRef(),
                LS_ROLES_ALL,
                handler.as_concrete_TypeRef(),
            )
        };

        if status == 0 {
            Ok(())
        } else {
            // Realistically a bundle LaunchServices has never seen, which is what
            // running from `cargo` rather than from /Applications looks like.
            Err(format!(
                "macOS refused the change (OSStatus {status}). \
                 Obelisk has to be installed in /Applications and launched once first."
            ))
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use std::path::PathBuf;
    use std::process::Command;

    use super::DefaultEditorState;

    /// Both spellings, because which one a desktop environment consults varies
    /// and file managers still look up the legacy `x-` form.
    const MIME_TYPES: &[&str] = &["text/markdown", "text/x-markdown"];

    /// Entry names the bundlers produce, plus the lowercase form a hand-written
    /// AppImage entry usually gets.
    const ENTRIES: &[&str] = &["Obelisk.desktop", "obelisk.desktop"];

    /// `$XDG_DATA_HOME` then `$XDG_DATA_DIRS`, each with the spec's default, in
    /// the order the spec says they take precedence.
    fn data_dirs() -> Vec<PathBuf> {
        let home = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")));

        let shared = std::env::var("XDG_DATA_DIRS")
            .unwrap_or_else(|_| "/usr/local/share:/usr/share".to_string());

        home.into_iter()
            .chain(
                shared
                    .split(':')
                    .filter(|d| !d.is_empty())
                    .map(PathBuf::from),
            )
            .collect()
    }

    /// The desktop entry `xdg-mime` should be pointed at, which only exists once
    /// Obelisk is installed rather than run from the build directory.
    fn installed_entry() -> Option<String> {
        for dir in data_dirs() {
            for entry in ENTRIES {
                if dir.join("applications").join(entry).is_file() {
                    return Some((*entry).to_string());
                }
            }
        }
        None
    }

    fn xdg_mime(args: &[&str]) -> Result<String, String> {
        let out = Command::new("xdg-mime")
            .args(args)
            .output()
            .map_err(|err| format!("xdg-mime is not available: {err}"))?;

        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    }

    /// Whichever entry currently owns the primary MIME type. An empty answer is
    /// `xdg-mime`'s way of saying nothing is bound, so it is not a name.
    fn current_handler() -> Option<String> {
        xdg_mime(&["query", "default", MIME_TYPES[0]])
            .ok()
            .filter(|entry| !entry.is_empty())
    }

    pub fn state(_bundle_id: &str) -> DefaultEditorState {
        let current = current_handler();
        let Some(entry) = installed_entry() else {
            return DefaultEditorState {
                supported: true,
                default: false,
                current,
                blocked: Some(
                    "No Obelisk desktop entry is installed. Install the .deb, or write one for the AppImage."
                        .to_string(),
                ),
            };
        };

        DefaultEditorState {
            supported: true,
            default: current.as_deref() == Some(entry.as_str()),
            current,
            blocked: None,
        }
    }

    pub fn make_default(_bundle_id: &str) -> Result<(), String> {
        let entry = installed_entry().ok_or_else(|| {
            "No Obelisk desktop entry is installed, so there is nothing to point the MIME type at."
                .to_string()
        })?;

        let mut args = vec!["default", entry.as_str()];
        args.extend_from_slice(MIME_TYPES);
        xdg_mime(&args)?;
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod platform {
    use super::DefaultEditorState;

    pub fn state(_bundle_id: &str) -> DefaultEditorState {
        DefaultEditorState {
            supported: false,
            default: false,
            current: None,
            blocked: Some("Only macOS and Linux are supported.".to_string()),
        }
    }

    pub fn make_default(_bundle_id: &str) -> Result<(), String> {
        Err("Only macOS and Linux are supported.".to_string())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    /// Exercises the LaunchServices read path for real. A wrong extern signature
    /// or a misread ownership rule surfaces here as a crash or a corrupt string,
    /// rather than in front of the user. Nothing here *writes* a binding — that
    /// would reach outside the test and change the machine's preferences.
    #[test]
    fn reads_the_markdown_handler_without_claiming_it() {
        let observed = state("com.example.not-a-real-installed-app");

        assert!(observed.supported);
        assert!(!observed.default);
        assert!(observed.blocked.is_none());
        assert!(observed.current.as_deref() != Some(""));
    }

    #[test]
    fn recognises_the_holder_of_the_binding_whatever_its_case() {
        // Skipped rather than asserted when no editor is bound, which is the
        // state of a fresh machine or a CI runner.
        if let Some(current) = state("").current {
            assert!(state(&current.to_uppercase()).default);
            assert!(state(&current.to_lowercase()).default);
        }
    }
}
