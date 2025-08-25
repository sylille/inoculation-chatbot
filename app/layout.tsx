import './globals.css'
import { SpeedInsights } from "@vercel/speed-insights/next"

export const metadata = { title: 'My Chat', description: 'Inoculation Chat Beta' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <div className="min-h-screen">{children}</div>
      </body>
    </html>
  )
}
