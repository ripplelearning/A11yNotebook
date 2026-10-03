import { useEffect, useRef, useState } from 'react';
import { scheduleCard, type CardSchedule, type Flashcard } from '../../../shared/assets';

export interface FlashcardReviewProps {
  cards: Flashcard[];
  schedules?: Record<string, CardSchedule>;
  today?: string;
  onSchedule?: (cardId: string, schedule: CardSchedule) => void | Promise<void>;
  announce?: (message: string) => void;
}

export default function FlashcardReview({
  cards,
  schedules = {},
  today = new Date().toISOString().slice(0, 10),
  onSchedule,
  announce,
}: FlashcardReviewProps) {
  const [local, setLocal] = useState<Record<string, CardSchedule>>({});
  const [revealedId, setRevealedId] = useState<string>();
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const answerHeading = useRef<HTMLHeadingElement>(null);
  const statusElement = useRef<HTMLParagraphElement>(null);
  const section = useRef<HTMLElement>(null);
  const pendingFocus = useRef(false);
  const card = cards.find((item) => {
    const schedule = local[item.id] ?? schedules[item.id];
    return !schedule || schedule.due <= today;
  });
  const revealed = Boolean(card && card.id === revealedId);
  useEffect(() => {
    if (pendingFocus.current) {
      (revealed ? answerHeading.current : (heading.current ?? statusElement.current ?? section.current))?.focus();
      pendingFocus.current = false;
    }
  }, [card?.id, revealed, status]);
  return (
    <section ref={section} tabIndex={-1} aria-label="Flashcard review">
      {error && <p role={announce ? undefined : 'alert'}>{error}</p>}
      {!announce && (
        <p ref={statusElement} tabIndex={-1} role="status">
          {!card ? `No cards due. ${status}` : status || 'A card is ready to review.'}
        </p>
      )}
      {announce && !card && <p>No cards due.</p>}
      {card && (
        <>
          <h3 ref={heading} tabIndex={-1}>
            Question
          </h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{card.question}</p>
          {!revealed && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                pendingFocus.current = true;
                setRevealedId(card.id);
              }}
            >
              Show answer
            </button>
          )}
          {revealed && (
            <div>
              <h3 ref={answerHeading} tabIndex={-1}>
                Answer
              </h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>{card.answer}</p>
              <fieldset>
                <legend>Rate your recall</legend>
                {[
                  { label: 'Again', quality: 1 },
                  { label: 'Hard', quality: 3 },
                  { label: 'Good', quality: 4 },
                  { label: 'Easy', quality: 5 },
                ].map(({ label, quality }) => (
                  <button
                    type="button"
                    key={label}
                    disabled={busy}
                    onClick={() => {
                      const schedule = scheduleCard(local[card.id] ?? schedules[card.id], quality, today);
                      const finish = () => {
                        setLocal((previous) => ({ ...previous, [card.id]: schedule }));
                        pendingFocus.current = true;
                        setRevealedId(undefined);
                        const message = `Card reviewed. Next due ${schedule.due}.`;
                        setStatus(message);
                        setBusy(false);
                        announce?.(message);
                      };
                      const fail = (failure: unknown) => {
                        setBusy(false);
                        setStatus('Card review was not saved.');
                        const message = failure instanceof Error ? failure.message : 'Could not save the card review.';
                        setError(message);
                        announce?.(message);
                      };
                      setError('');
                      try {
                        const result = onSchedule?.(card.id, schedule);
                        if (result) {
                          setBusy(true);
                          setStatus('Saving card review.');
                          void Promise.resolve(result).then(finish, fail);
                        } else finish();
                      } catch (failure) {
                        fail(failure);
                      }
                    }}
                  >
                    {label}
                  </button>
                ))}
              </fieldset>
            </div>
          )}
        </>
      )}
    </section>
  );
}
