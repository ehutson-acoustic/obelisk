import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
/* Below the `App` import, not above it: Vite emits CSS in module-graph order,
   and styles/vendor.css has to land after the Crepe and xterm stylesheets that
   arrive through App -> Editor / Terminal. See styles/index.css. */
import "./styles/index.css";

/** Without this a render error leaves a blank window and no way to see why. */
class ErrorBoundary extends React.Component<
    { children: React.ReactNode },
    { error: Error | null }
> {
    state = {error: null as Error | null};

    static getDerivedStateFromError(error: Error) {
        return {error};
    }

    render() {
        if (!this.state.error) return this.props.children;
        return (
            <div className="crash">
                <h1>Obelisk hit an error</h1>
                <pre>{this.state.error.stack ?? this.state.error.message}</pre>
            </div>
        );
    }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <ErrorBoundary>
            <App/>
        </ErrorBoundary>
    </React.StrictMode>,
);
