type PageHeaderProps = {
  title: string;
  intro?: string;
};

export function PageHeader({ title, intro }: PageHeaderProps) {
  return (
    <header className="border-b border-line pb-8">
      <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-action">orinks.net</p>
      <h1 className="max-w-4xl text-4xl font-bold text-ink sm:text-5xl">{title}</h1>
      {intro ? <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-700">{intro}</p> : null}
    </header>
  );
}
