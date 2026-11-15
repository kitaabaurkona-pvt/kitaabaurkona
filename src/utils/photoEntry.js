// One photo in the admin photo list: a stable key for React plus its link.
let nextKey = 0;
export const photoEntry = (url) => ({ key: `p${++nextKey}`, url, uploading: false });
