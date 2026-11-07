import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card card-pad w-full max-w-sm">
        <div className="mb-6">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-lg font-bold text-white">T</div>
          <h1 className="text-xl font-semibold">Tekstil Üretim Takip</h1>
          <p className="text-sm text-slate-500">Hesabınızla giriş yapın</p>
        </div>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
