/** Shown on a browse page whose data couldn't be fetched, so an outage never looks like "nothing listed yet". */
export default function LoadErrorNotice({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </p>
  );
}
