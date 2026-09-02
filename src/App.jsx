import Pages from '@/pages/index.jsx';
import SandboxBanner from '@/components/SandboxBanner';
import { Toaster as Sonner } from '@/components/ui/sonner';

function App() {
 return (
 <>
 <SandboxBanner />
 <Pages />
 <Sonner position="bottom-right"richColors />
 </>
 );
}

export default App;
