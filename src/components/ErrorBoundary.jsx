import React from "react";

/**
 * Last-resort guard so a calculation or render error never leaves the desk
 * with a blank screen. The reset handler is supplied by the root so the boundary
 * can clear the deal state that caused the failure.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (typeof console !== "undefined") {
      console.error("Payment Desk render error", error?.name, info?.componentStack);
    }
  }

  handleReset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-error" role="alert">
        <h1>Something went wrong</h1>
        <p>The calculator hit an unexpected error. Reset the deal to keep working. No customer information was stored or sent.</p>
        <button className="reset-button" onClick={this.handleReset} type="button">
          Reset deal
        </button>
      </div>
    );
  }
}
