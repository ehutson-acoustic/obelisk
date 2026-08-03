import {useCallback, useEffect, useMemo, useState} from "react";
import {type AppSettings, DEFAULT_APP_SETTINGS, loadAppSettings, saveAppSettings,} from "../lib/appSettings";
import {
    type EditorSettings,
    mergeSettings,
    paletteCss,
    type ProjectOverrides,
    resolveComponents,
    themeCss,
    themeDef,
} from "../lib/editorSettings";
import type {DiagramStyle} from "../lib/mermaid";
import {loadProjectSettings} from "../lib/projectSettings";
import {applyTheme, injectStyle, resolveTheme, type Theme, watchSystemTheme,} from "../lib/theme";
import type {Project} from "../types";

/**
 * Settings, the resolved theme, and every DOM-level mechanism that applies it
 * (DESIGN §5.3). All three stylesheets are generated text injected into `<head>`
 * rather than inline styles, because ProseMirror creates and destroys the nodes
 * they target as you type.
 */
export function useAppearance(activeProject: Project | null, zoom: number) {
    const [appSettings, setAppSettings] =
        useState<AppSettings>(DEFAULT_APP_SETTINGS);
    const [theme, setTheme] = useState<Theme>(() =>
        resolveTheme(DEFAULT_APP_SETTINGS.appearance),
    );
    const [projectOverrides, setProjectOverrides] = useState<ProjectOverrides>({});

    useEffect(() => {
        loadAppSettings().then(setAppSettings);
    }, []);

    useEffect(() => {
        if (!activeProject) {
            setProjectOverrides({});
            return;
        }
        loadProjectSettings(activeProject.dir).then(setProjectOverrides);
    }, [activeProject]);

    useEffect(() => {
        const apply = () => {
            const next = resolveTheme(appSettings.appearance);
            setTheme(next);
            applyTheme(next);
        };
        apply();
        if (appSettings.appearance !== "system") return;
        return watchSystemTheme(apply);
    }, [appSettings.appearance]);

    const updateSettings = useCallback((next: AppSettings) => {
        setAppSettings(next);
        saveAppSettings(next);
    }, []);

    /** App defaults with the active project's overrides applied (DESIGN §5.2). */
    const editorSettings: EditorSettings = useMemo(
        () => mergeSettings(appSettings.editor, projectOverrides),
        [appSettings.editor, projectOverrides],
    );

    // Markdown styling is injected as a stylesheet rather than inline styles, so
    // it applies to nodes ProseMirror creates and destroys as you type.
    useEffect(() => {
        injectStyle("md-theme", themeCss(editorSettings));
    }, [editorSettings]);

    // The theme's palette overrides the `:root` variables `styles/base.css`
    // declares (DESIGN §5.3). Separate from md-theme so a theme switch does not
    // rewrite the Markdown sheet, and vice versa.
    useEffect(() => {
        injectStyle("app-palette", paletteCss(editorSettings));
    }, [editorSettings]);

    /** The active half of the active theme, for the things CSS cannot reach. */
    const palette = useMemo(
        () => themeDef(editorSettings.theme)[theme],
        [editorSettings.theme, theme],
    );

    /**
     * Mermaid diagrams are the one thing a theme switch cannot restyle through a
     * stylesheet — mermaid resolves colors while it lays a diagram out and
     * writes them into the SVG (DESIGN §2.6) — so the values it needs are passed
     * down as data rather than left to CSS.
     */
    const diagramStyle: DiagramStyle = useMemo(() => {
        const body = resolveComponents(editorSettings).body;
        return {
            theme,
            palette,
            fontFamily: body.fontFamily ?? "",
            fontSize: body.fontSize ?? "",
        };
    }, [editorSettings, theme, palette]);

    /**
     * Set on the root rather than the editor panel: `--content-width` is declared
     * at `:root` in terms of this, so scoping it lower would leave the measure
     * reading the fallback. Nothing outside the editor's own rules refers to it,
     * so app chrome stays put (DESIGN §7).
     */
    useEffect(() => {
        document.documentElement.style.setProperty("--editor-zoom", String(zoom));
    }, [zoom]);

    return {
        appSettings,
        updateSettings,
        theme,
        palette,
        editorSettings,
        diagramStyle,
        /** The dialog writes overrides straight back for the active project. */
        setProjectOverrides,
    };
}
