import { Component } from 'react';

export default class ErrorBoundary extends Component {
 constructor(props) {
 super(props);
 this.state = { hasError: false };
 }

 static getDerivedStateFromError() {
 return { hasError: true };
 }

 componentDidCatch(error, info) {
  
 console.error('Chunk load error:', error, info);
 }

 handleRetry = () => {
 this.setState({ hasError: false });
 if (typeof window !== 'undefined') {
 // best-effort refresh to re-request the chunk
 window.location.reload();
 }
 };

 render() {
 if (this.state.hasError) {
 return (
 <div className="min-h-screen flex items-center justify-center p-8 text-center">
 <div>
 <h2 className="text-xl font-semibold mb-2">Something went wrong loading this page.</h2>
 <p className="text-muted-foreground mb-4">Please check your connection and try again.</p>
 <button onClick={this.handleRetry} className="px-4 py-2 rounded bg-primary text-background">Retry</button>
 </div>
 </div>
 );
 }
 return this.props.children;
 }
}


