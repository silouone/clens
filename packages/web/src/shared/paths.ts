/**
 * Path matching utilities shared between server and client.
 *
 * Handles the case where file paths may be absolute or relative,
 * e.g. diff_attribution uses relative paths while file_map uses absolute.
 */

/** Normalize a path by stripping trailing slashes (preserving root "/"). */
const normalize = (p: string): string => {
	const trimmed = p.replace(/\/+$/, "")
	return trimmed === "" ? p : trimmed
}

/** Check if a path looks like a real file (not /dev/null or a directory). */
export const isFilePath = (path: string): boolean =>
	path !== "/dev/null" &&
	!path.endsWith("/") &&
	/\.[a-zA-Z0-9]+$/.test(path.split("/").pop() ?? "")

/** Check if two paths refer to the same file via suffix matching. */
export const pathsMatch = (a: string, b: string): boolean => {
	if (a === "" || b === "") return false
	const na = normalize(a)
	const nb = normalize(b)
	return na === nb || na.endsWith(`/${nb}`) || nb.endsWith(`/${na}`)
}
