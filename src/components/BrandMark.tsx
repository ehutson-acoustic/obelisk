/**
 * The app mark, kept in sync with src-tauri/icons/icon.svg.
 *
 * Inline SVG rather than the `‡` character it replaces: the double obelisk is
 * missing or wildly off-metric in a lot of UI fonts, so the glyph rendered at a
 * different weight and baseline on every machine. The viewBox crops to the
 * plate (the icon file pads it out to 1024 for the OS), and the two-tone faces
 * and shadows of the full icon are dropped -- below ~32px they only muddy it.
 */
export function BrandMark({size = 22}: Readonly<{ size?: number }>) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="80 80 864 864"
            aria-hidden="true"
            focusable="false"
        >
            <defs>
                <linearGradient id="brand-plate" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#ffffff"/>
                    <stop offset="0.38" stopColor="#c3c8d3"/>
                    <stop offset="0.5" stopColor="#e3e6ec"/>
                    <stop offset="0.62" stopColor="#bcc1cd"/>
                    <stop offset="1" stopColor="#767d8b"/>
                </linearGradient>
            </defs>
            <rect x="80" y="80" width="864" height="864" rx="196" fill="url(#brand-plate)"/>
            <rect
                x="81.5"
                y="81.5"
                width="861"
                height="861"
                rx="194.5"
                fill="none"
                stroke="#4a515e"
                strokeOpacity="0.3"
                strokeWidth="3"
            />
            <g fill="#333a46">
                <rect x="477" y="198" width="70" height="634" rx="8"/>
                <rect x="340" y="300" width="344" height="58" rx="8"/>
                <rect x="375" y="672" width="275" height="58" rx="8"/>
            </g>
        </svg>
    );
}
