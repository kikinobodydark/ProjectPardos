import React from 'react';
import { FiAlertTriangle, FiRefreshCw } from 'react-icons/fi';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'Ocurrió un error inesperado al renderizar la vista.',
    };
  }

  componentDidCatch(error, errorInfo) {
    if (import.meta.env.DEV) {
      console.error('ErrorBoundary capturó un error:', error, errorInfo);
    }
  }

  handleReload = () => {
    this.setState({ hasError: false, errorMessage: '' });
    if (this.props.onReset) {
      this.props.onReset();
    } else if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="d-flex align-items-center justify-content-center min-vh-100 p-4" style={{ backgroundColor: '#F8FAFC' }}>
          <div className="card-premium p-4 text-center" style={{ maxWidth: '480px', width: '100%' }}>
            <FiAlertTriangle className="text-danger fs-1 mb-3" />
            <h5 className="fw-bold mb-2">Algo salió mal en esta pantalla</h5>
            <p className="text-muted mb-3" style={{ fontSize: '0.88rem' }}>
              {this.state.errorMessage}
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="btn btn-primary px-4 py-2 rounded-3 fw-semibold d-inline-flex align-items-center gap-2"
            >
              <FiRefreshCw />
              <span>Reintentar / Recargar</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
