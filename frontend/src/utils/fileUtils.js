/** Extracts the bare filename from a Windows or Unix file path. */
export const extractFilename = (filePath) => filePath.split('\\').pop().split('/').pop();
