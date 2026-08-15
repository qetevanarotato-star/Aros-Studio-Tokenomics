import { addPropertyControls, ControlType } from "framer"
import { useMemo, type CSSProperties } from "react"

/**
 * Bind Framer site to live AST portal process.
 * Keeps your Framer Top Bar / logo / titles.
 * Embeds full portal flow: login → verification → tokenization → certificate.
 * Uses ?embed=1 so Next header/footer are hidden.
 *
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight any
 */

interface Props {
    portalBase: string
    path: string
    lang: string
    minHeight: number
    background: string
    style?: CSSProperties
}

export default function AstPortalFrame(props: Props) {
    const base = (props.portalBase || "").trim().replace(/\/$/, "")
    const path = (props.path || "/login").trim() || "/login"
    const lang = props.lang || "ru"
    const minHeight = props.minHeight ?? 960
    const bg = props.background ?? "transparent"

    const src = useMemo(() => {
        if (!base || base.indexOf("YOUR") >= 0) return ""
        try {
            const p = path.startsWith("/") ? path : "/" + path
            const u = new URL(base + p)
            u.searchParams.set("embed", "1")
            if (lang) u.searchParams.set("lang", lang)
            return u.toString()
        } catch {
            return ""
        }
    }, [base, path, lang])

    if (!src) {
        return (
            <div
                style={{
                    ...props.style,
                    width: "100%",
                    minHeight: 200,
                    padding: 24,
                    boxSizing: "border-box",
                    background: bg,
                    fontFamily: "Inter, system-ui, sans-serif",
                    color: "#404040",
                    fontSize: 14,
                    lineHeight: 1.5,
                }}
            >
                Set <b>Portal URL</b> from Mac:{" "}
                <code>bash scripts/home-tunnel.sh && cat .home-run/public-url.txt</code>
            </div>
        )
    }

    return (
        <div
            style={{
                ...props.style,
                width: "100%",
                minHeight,
                background: bg,
                borderRadius: 0,
                overflow: "hidden",
            }}
        >
            <iframe
                title="AST Portal Process"
                src={src}
                style={{
                    width: "100%",
                    height: minHeight,
                    border: "none",
                    display: "block",
                    background: "#ffffff",
                }}
                allow="clipboard-read; clipboard-write"
            />
        </div>
    )
}

addPropertyControls(AstPortalFrame, {
    portalBase: {
        type: ControlType.String,
        title: "Portal URL",
        defaultValue: "",
    },
    path: {
        type: ControlType.Enum,
        title: "Process page",
        options: ["/login", "/dashboard", "/tokenization", "/nodechain", "/explore"],
        optionTitles: [
            "1. Login / verification",
            "2. Cabinet desk",
            "3. Tokenization → certificate",
            "4. NodeChain journal",
            "5. Public explore",
        ],
        defaultValue: "/login",
    },
    lang: {
        type: ControlType.Enum,
        title: "Language",
        options: ["ru", "ka", "en"],
        optionTitles: ["Русский", "ქართული", "English"],
        defaultValue: "ru",
    },
    minHeight: {
        type: ControlType.Number,
        title: "Height",
        defaultValue: 960,
        min: 560,
        max: 2400,
    },
    background: {
        type: ControlType.Color,
        title: "Background",
        defaultValue: "transparent",
    },
})
