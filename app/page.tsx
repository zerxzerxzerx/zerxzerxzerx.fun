import BioLink from '@/components/BioLink'

export default function Home() {
  return (
    <>
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-grid" />
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-vignette" />
      <main className="relative flex min-h-screen items-center justify-center py-20">
        <BioLink />
      </main>
    </>
  )
}
