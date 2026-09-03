import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <Compass size={38} className="text-zinc-700" />
      <h1 className="text-2xl font-bold text-zinc-200">That page isn't in the vault</h1>
      <p className="max-w-sm text-sm text-zinc-500">
        The link may be stale, or the album it pointed at was removed from the collection.
      </p>
      <Link to="/" className="btn-primary">
        Back to the archive
      </Link>
    </div>
  );
}
