/**
 * A captured webpage file: the raw captured HTML of a public page, saved
 * as a standalone file in a notebook instead of as an editable note.
 * The marker is part of the file name, so it survives a cloud-sync file
 * replacement the way an origin record would not.
 */
export const WEBPAGE_SUFFIX = '.webpage.html';

export function isWebpagePath(value: string): boolean {
  return /\.webpage\.html?$/i.test(value);
}
