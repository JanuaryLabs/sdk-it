import { parse } from "fast-content-type-parse";

function isBinaryContentType(contentType: string) {
	const type = contentType.toLowerCase();
	if (type.startsWith("image/")) {
		return true;
	}
	if (type.startsWith("audio/")) {
		return true;
	}
	if (type.startsWith("video/")) {
		return true;
	}
	switch (type) {
		case "application/pdf":
		case "application/zip":
		case "application/gzip":
		case "application/x-7z-compressed":
		case "application/x-tar":
		case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
		case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
		case "application/vnd.ms-excel":
		case "application/vnd.ms-powerpoint":
		case "application/msword":
		case "application/octet-stream":
			return true;
		default:
			return false;
	}
}

async function handleChunkedResponse(response: Response, contentType: string) {
	const { type } = parse(contentType);

	switch (type) {
		case "application/json": {
			let buffer = "";
			const reader = response.body!.getReader();
			const decoder = new TextDecoder();
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value);
			}
			return JSON.parse(buffer);
		}
		case "text/html":
		case "text/plain": {
			let buffer = "";
			const reader = response.body!.getReader();
			const decoder = new TextDecoder();
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value);
			}
			return buffer;
		}
		default:
			return response.body;
	}
}

export function chunked(response: Response) {
	return response.body!;
}

export async function buffered(response: Response) {
	const contentType = response.headers.get("Content-Type");
	if (!contentType) {
		throw new Error("Content-Type header is missing");
	}

	if (response.status === 204) {
		return null;
	}

	const { type } = parse(contentType);
	if (isBinaryContentType(type)) {
		return response.blob();
	}
	if (type.startsWith("text/")) {
		return response.text();
	}
	switch (type) {
		case "application/json":
			return response.json();
		case "application/xml":
			return response.text();
		case "application/x-www-form-urlencoded": {
			const text = await response.text();
			return Object.fromEntries(new URLSearchParams(text));
		}
		case "multipart/form-data":
			return response.formData();
		default:
			throw new Error(`Unsupported content type: ${contentType}`);
	}
}
