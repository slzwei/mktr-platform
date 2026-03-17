import './App.css';
import Pages from '@/pages/index.jsx';
import { Toaster as Sonner } from '@/components/ui/sonner';

function App() {
  return (
    <>
      <Pages />
      <Sonner position="bottom-right" richColors />
    </>
  );
}

export default App;
