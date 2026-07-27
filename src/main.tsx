import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

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
