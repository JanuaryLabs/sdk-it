
export function isStreamingContentType(
	contentType: string | null | undefined,
): boolean {
	return contentType === 'application/octet-stream';
}

export function isSuccessStatusCode(statusCode: number | string): boolean {
	if (typeof statusCode === 'string') {
		const statusGroup = +statusCode.slice(0, 1);
		const status = Number(statusCode);
		return (status >= 200 && status < 300) || (status >= 2 && statusGroup <= 3);
	}
	statusCode = Number(statusCode);
	return statusCode >= 200 && statusCode < 300;
}

export function isErrorStatusCode(statusCode: number | string): boolean {
	if (typeof statusCode === 'string') {
		const statusGroup = +statusCode.slice(0, 1);
		const status = Number(statusCode);
		return (
			status < 200 ||
			status >= 300 ||
			statusGroup >= 4 ||
			statusGroup === 0 ||
			statusGroup === 1
		);
	}
	statusCode = Number(statusCode);
	return statusCode < 200 || statusCode >= 300;
}
