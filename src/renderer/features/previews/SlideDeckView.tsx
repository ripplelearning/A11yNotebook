import { useEffect, useState } from 'react';
import type { SlideDeck } from '../../../shared/slides';

interface Props {
  path: string;
  announce: (message: string) => void;
}

export default function SlideDeckView({ path, announce }: Props) {
  const [deck, setDeck] = useState<SlideDeck | null>(null);
  const [error, setError] = useState('');
  const [slideIndex, setSlideIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const vault = window.a11yNotebook?.vault;
    if (!vault) {
      setError('The local slide reader is unavailable.');
      return;
    }
    void vault
      .readSlideDeck(path)
      .then((loaded) => {
        if (cancelled) return;
        setDeck(loaded);
        setSlideIndex(0);
        setError('');
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'This slide deck could not be read.');
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (error) return <p>{error}</p>;
  if (!deck) return <p>Loading slide deck…</p>;
  const slide = deck.slides[slideIndex];
  if (!slide) return <p>This deck has no slides.</p>;

  return (
    <div>
      <p>
        {deck.slides.length} {deck.slides.length === 1 ? 'slide' : 'slides'}. Slides are read-only in this
        release.
        {deck.truncated && deck.truncationReason ? ` ${deck.truncationReason}` : null}
      </p>
      <ul>
        {deck.slides.map((entry, index) => (
          <li key={index}>
            <button
              type="button"
              aria-current={index === slideIndex}
              onClick={() => {
                setSlideIndex(index);
                announce(`Slide ${index + 1}${entry.title ? `: ${entry.title}` : ''}.`);
              }}
            >
              Slide {index + 1}
              {entry.title ? `: ${entry.title}` : ''}
            </button>
          </li>
        ))}
      </ul>
      <h3>
        Slide {slide.index + 1}
        {slide.title ? `: ${slide.title}` : ''}
      </h3>
      {slide.blocks.map((block, index) =>
        block.text.split('\n').map((line, lineIndex) => (
          <p key={`${index}-${lineIndex}`}>{line}</p>
        )),
      )}
      {slide.notes ? (
        <>
          <h4>Speaker notes</h4>
          {slide.notes.split('\n').map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </>
      ) : null}
    </div>
  );
}
