/** Marks a value that is a placeholder parameter, not a signed-off requirement (docs/OPEN_QUESTIONS.md). */
export function OpenQuestionTag({ id }: { id: string }) {
  return (
    <span className="inline-flex items-center rounded border border-dashed border-amber-400 px-1 text-[10px] font-medium tracking-wide whitespace-nowrap text-amber-700 uppercase dark:text-amber-300" title={`Placeholder value — see docs/OPEN_QUESTIONS.md ${id}`}>
      Open question {id}
    </span>
  )
}
