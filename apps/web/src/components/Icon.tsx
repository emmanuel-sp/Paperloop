const paths: Record<string, string> = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  research: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z M16 16l5 5',
  evaluations: 'M9 4H5v17h14V4h-4 M9 2h6v4H9z M8 11h8 M8 16h5',
  experiments: 'M9 3h6 M10 3v7L4 20h16l-6-10V3 M8 15h8',
  schedules: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
  sources: 'M4 4h16v5H4z M4 15h16v5H4z M8 9v6 M16 9v6',
  settings: 'M4 7h16 M4 17h16 M9 4v6 M15 14v6',
  plus: 'M12 5v14 M5 12h14',
};
export function Icon({ name }: { name: string }) {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.overview} />
    </svg>
  );
}
