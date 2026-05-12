import '../styles/globals.css'
import React from 'react'

export const metadata = { title: 'CV Missions Dashboard' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body className="min-h-screen bg-neutral-50 text-neutral-900">
                <div className="mx-auto max-w-7xl p-4">
                    <header className="mb-6 flex items-center justify-between">
                        <h1 className="text-2xl font-bold">CV Missions Dashboard</h1>
                        <nav className="space-x-4">
                            <a className="hover:underline" href="/">Dashboard</a>
                            <a className="hover:underline" href="/cameras">Cameras</a>
                            <a className="hover:underline" href="/missions">Missions</a>
                            <a className="hover:underline" href="/analytics">Analytics</a>
                        </nav>
                    </header>
                    {children}
                </div>
            </body>
        </html>
    )
}