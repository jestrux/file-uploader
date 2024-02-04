import axios from "axios";
import EM from "EventEmitter";
import S3FileUpload from "./S3";

function FileUploader(el, { url, s3, type, maxSize = 10 * 1_000_000 } = {}) {
	this.fileType = type;
	this.maxSize = maxSize;
	this.em = new EM();
	this.upload_path = url;
	this.s3Config = s3;
	this.el = el;
	const input = el.querySelector("input");

	this.accepts = () => {
		const sheets =
			".csv, text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel, .tab, .tsv";
		const docs = ".doc, .docx, .pdf, application/pdf";
		const images = ".png, .svg, .jpg, .jpeg, .webp, .gif";
		const videos = ".mp4, .webm, .mov";
		const misc = ".json, .txt";

		if (this.fileType == "image") return images;

		if (this.fileType == "video") return videos;

		if (["document", "doc"].includes(this.fileType))
			return [sheets, docs].join(",");

		return [sheets, docs, images, videos, misc].join(",");
	};

	this.supportedFileTypes = () => {
		const sheets = [
			"xlsx",
			"xls",
			"csv",
			"tab",
			"tsv",
			"spreadsheet",
			"excel",
		];

		const docs = ["pdf", "doc", "docx", "ppt"];

		const images = ["png", "svg", "jpg", "jpeg", "webp", "gif"];

		const videos = ["mp4", "webm", "mov"];

		const misc = ["json", "txt"];

		if (this.fileType == "image") return images;

		if (this.fileType == "video") return videos;

		if (["document", "doc"].includes(this.fileType))
			return [...sheets, ...docs];

		return [...sheets, ...docs, ...images, ...videos, ...misc];
	};

	if (input) {
		input.setAttribute("accepts", this.accepts());

		input.addEventListener("change", (e) => {
			this.FileSelectHandler(e);
		});
	}

	el.addEventListener("dragover", (e) => this.FileUploaderHover(e), false);
	el.addEventListener("dragleave", (e) => this.FileUploaderHover(e), false);
	el.addEventListener("drop", (e) => this.FileSelectHandler(e), false);

	return this;
}

FileUploader.prototype.FileUploaderHover = function (e) {
	e.stopPropagation();
	e.preventDefault();

	if (e.type == "dragover") {
		this.el.setAttribute("data-dragover", true);
		this.el.classList.add("dragover");
	} else {
		this.el.removeAttribute("data-dragover");
		this.el.classList.remove("dragover");
	}
};

FileUploader.prototype.FileSelectHandler = function (e) {
	e.stopPropagation();
	e.preventDefault();

	this.FileUploaderHover(e);

	var files = e.target.files || e.dataTransfer.files;

	if (!files || !files.length) return;

	const file = files[0];
	const typeSupported =
		!file.type || !file.type.length
			? null
			: this.supportedFileTypes(this.fileType).find(
					(type) => file.type.indexOf(type) != -1
			  );

	if (!typeSupported) {
		this.em.emit(
			"error",
			`Unsupported file type. Supported types: ${this.accepts()}`
		);

		return;
	}

	if (this.maxSize) {
		const fileSize = files[0].size;
		if (fileSize > this.maxSize) {
			this.em.emit(
				"error",
				`File is too large. Max file size is ${
					this.maxSize / 1_000_000
				}Mbs.`
			);

			return;
		}
	}

	const reader = new FileReader();
	reader.onload = (e) => {
		this.em.emit("preview", e.target.result, file);
		this.UploadFile(file);
	};
	reader.readAsDataURL(file);
};

FileUploader.prototype.UploadFile = function (file) {
	if (this.upload_path == "s3") {
		S3FileUpload.uploadFile(file, {
			...(this.s3Config || {}),
			onProgress: (percent) => {
				this.em.emit("progress", percent);
			},
		})
			.then(({ location }) => {
				this.em.emit("success", location);
			})
			.catch((error) => {
				this.em.emit("error", error);
			});

		return;
	}

	const config = {
		headers: { "content-type": "multipart/form-data" },
		onUploadProgress: (progressEvent) => {
			this.em.emit(
				"progress",
				(progressEvent.loaded * 100) / progressEvent.total
			);
		},
	};

	const form = new FormData();
	const name = file.name.replace(/ /g, "-");
	const ext = name.split(".").pop();
	form.append("photo", file);
	form.append("name", name);
	form.append("ext", ext);
	form.append("fileType", this.fileType);

	axios
		.post(this.upload_path, form, config)
		.then((result) => {
			const res = result.data;
			let payload = res;

			if (res?.path || res.url) payload = res.path || res.url;

			if (!(res.success ?? true)) {
				throw (
					res.msg ??
					res.message ??
					"Unknown error while uploading file"
				);
			}

			this.em.emit("success", payload);
		})
		.catch((e) => {
			this.em.emit("error", e);
		});
};

const fileUploader = function (
	el,
	{
		type = "",
		uploadUrl,
		s3,
		maxSize = 10 * 1_000_000,
		onChange = (_) => {},
		onError = (_) => {},
		onSuccess = (_) => {},
	} = {}
) {
	const data = {
		src: null,
		preview: null,
		file: null,
		uploading: false,
		progress: 0,
		error: null,
	};

	const update = (newData = {}, status) => {
		if (Object.keys(newData).length) {
			onChange({
				...data,
				error: null,
				...newData,
			});
		}

		if (status) el.setAttribute("data-status", status);
	};

	if (
		!uploadUrl?.length &&
		s3 &&
		Object.values(s3).filter((v) => v?.length).length >= 4
	) {
		uploadUrl = "s3";
	}

	const { em } = new FileUploader(el, {
		url: uploadUrl,
		s3,
		type,
		maxSize,
	});

	update({}, "idle");

	em.on("preview", function (preview, file) {
		update({ preview, file, uploading: true }, "preview");
	});

	em.on("progress", function (progress) {
		update({ progress }, "loading");
	});

	em.on("error", function (error) {
		update({ uploading: false, src: null, error }, "error");
		onError(error);
	});

	em.on("success", function (payload) {
		if (!payload?.length) {
			const error = "File upload failed";
			update({ uploading: false, src: null, error }, "error");
			onError(error);
			return;
		}

		update({ uploading: false, src: payload }, "success");
		onSuccess(payload);
	});

	return () => {
		update(
			{
				src: null,
				preview: null,
				file: null,
				uploading: false,
				progress: 0,
				error: null,
			},
			"idle"
		);
	};
};

window.dispatchEvent(new CustomEvent("FileUploader:loaded"));

export default fileUploader;
