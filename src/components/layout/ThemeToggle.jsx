import { Moon, Sun } from"lucide-react";
import { Button } from"@/components/ui/button";
import { useEffect, useState } from"react";

export default function ThemeToggle() {
 const [dark, setDark] = useState(() => {
 if (typeof window === 'undefined') return false;
 return localStorage.getItem('theme') === 'dark' ||
 (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
 });

 useEffect(() => {
 const root = document.documentElement;
 if (dark) {
 root.classList.add('dark');
 localStorage.setItem('theme', 'dark');
 } else {
 root.classList.remove('dark');
 localStorage.setItem('theme', 'light');
 }
 }, [dark]);

 return (
 <Button
 variant="ghost" size="sm" onClick={() => setDark(!dark)}
 className="h-9 w-9 p-0" >
 {dark ? <Sun className="h-4 w-4"/> : <Moon className="h-4 w-4"/>}
 </Button>
 );
}
