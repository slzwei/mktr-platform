import './App.css'
import Pages from "@/pages/index.jsx"
import { Toaster } from "@/components/ui/toaster"
import { Toaster as Sonner } from "@/components/ui/sonner"

function App() {
  return (
    <>
      <Pages />
      {/* TODO: Migrate all useToast() consumers to sonner's toast(), then remove <Toaster /> */}
      <Toaster />
      <Sonner position="bottom-right" richColors />
    </>
  )
}

export default App