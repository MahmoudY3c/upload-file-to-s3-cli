const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  ObjectCannedACL,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const fs = require("fs");
const path = require("path");
const yargs = require("yargs");
const { hideBin } = require("yargs/helpers");

require("dotenv").config();

const {
  // S3_API_TOKEN,
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  S3_ENDPOINT, // like https://<ACCOUNT_ID>.r2.cloudflarestorage.com 
  S3_BUCKET_NAME,
} = process.env;

console.log({
  // S3_API_TOKEN,
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  S3_ENDPOINT,
  S3_BUCKET_NAME,
});

const ArgsList = Object.freeze({
  DELETE: "delete-after-upload",
});

// Setup CLI arguments using yargs
const argv = yargs(hideBin(process.argv))
  .option(ArgsList.DELETE, {
    alias: "d",
    type: "boolean",
    description: "Delete the file after successful upload",
  })
  .demandCommand(1, "You must provide a file to upload")
  .help().argv;

const s3 = new S3Client({
  region: "auto", // Cloudflare R2 does not require a region
  endpoint: S3_ENDPOINT,
  credentials: {
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  },
});

/**
 * @typedef {Parameters<typeof this.s3.send>[1]} sendOptions
 * @param {import('@aws-sdk/client-s3').PutObjectCommand['input']['Body']} fileBuffer
 * @param {string} fileName
 * @param {{
 * sendOptions: sendOptions,
 * paramsOptions: Omit<PutObjectCommand['input'], 'Bucket' | 'Key' | Body>
 * }} options
 */
async function uploadFile(filename = "file.txt", fileBuffer, options) {
  const params = {
    Bucket: S3_BUCKET_NAME,
    Key: filename,
    Body: fileBuffer,
    ContentType: "text/plain",
    ACL: ObjectCannedACL.private, // make file private
    ...(options?.paramsOptions || {}),
  };

  const command = new PutObjectCommand(params);

  try {
    await s3.send(command, options?.sendOptions);
    console.log("File uploaded successfully!");
  } catch (error) {
    console.error("Upload failed:", error);
  }
}

/**
 * delete file from bucket
 * @param {string} fileName
 * @param {string} VersionId
 */
async function deleteObject(fileName = "file.txt", VersionId) {
  try {
    const params = {
      Bucket: S3_BUCKET_NAME,
      Key: fileName,
    };

    // handle delete file without create a new version
    if (VersionId) {
      params.VersionId = VersionId;
    }

    return s3.send(new DeleteObjectCommand(params));
  } catch (err) {
    console.error("Error", err);
  }
}

/**
 * stream upload unknown length file to bucket
 * @param {import('@aws-sdk/client-s3').PutObjectCommand['input']['Body']} fileStream
 * @param {string} fileName
 * @param {{config?: import('@aws-sdk/lib-storage').Configuration & { signal: AbortSignal }, params?: Omit<import('@aws-sdk/lib-storage').Options['params'], 'Body' | 'Key' | 'Bucket'> }} options
 */
const uploadUnknownLengthStreamObject = (
  fileStream,
  fileName,
  options = {}
) => {
  try {
    /**
     * @type {import('@aws-sdk/lib-storage').Options['params']}
     */
    const params = {
      Bucket: S3_BUCKET_NAME,
      Key: fileName,
      Body: fileStream,
      ACL: ObjectCannedACL.private, // make file private
      ...(options.params || {}),
    };

    const upload = new Upload({
      client: s3, // Your S3 client instance
      params,
      queueSize: 5, // Parallelism
      // partSize: this.BytesConverter.KBToBytes(50), // 50KB part size to reduce chunk size
      ...(options.config || {}),
    });

    if (options.config?.signal) {
      options.config.signal.onabort = () => {
        console.log("............ upload aborted ..............");
        upload.abort();
      };
    }

    upload.on("httpUploadProgress", (progress) => {
      console.log(`Uploaded ${progress.loaded} of ${progress.total} bytes`);
    });

    console.log("trying to upload .....");
    return upload.done();
  } catch (err) {
    console.error("Error Uploading Files", err);
    throw err;
  }
};

/**
 * @param {string} fileName
 */
const checkObjectExist = async (fileName = "file.txt") => {
  const params = {
    Bucket: S3_BUCKET_NAME,
    Key: fileName,
  };

  try {
    await s3.send(new HeadObjectCommand(params));
    return true; // File exists
  } catch (err) {
    if (err.name === "NotFound") {
      return false; // File does not exist
    }

    throw err;
  }
};

async function downloadFile(Key = "file.txt") {
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key,
  });

  try {
    const { Body } = await s3.send(command);
    const data = await Body.transformToString();
    console.log("Downloaded content:", data);
  } catch (error) {
    console.error("Download failed:", error);
  }
}

/**
 * @param {string} fileName
 */
const getPublicFileAccessUrl = (fileName) =>
  `${s3.config.endpoint}/${S3_BUCKET_NAME}/${fileName}`;

/**
 * check if file exists before delete from bucket
 * @param {string} fileName
 * @param {string} VersionId
 */
const checkIfObjectExistsAndDelete = async (fileName, VersionId) => {
  const isFileExist = await checkObjectExist(fileName);

  if (!isFileExist) {
    throw new Error("File does not exist");
  }

  // If object exists, proceed to delete
  return this.deleteObject(fileName, VersionId);
};

async function listFiles() {
  const command = new ListObjectsV2Command({
    Bucket: S3_BUCKET_NAME,
  });

  try {
    const { Contents } = await s3.send(command);
    console.log(
      "Files in bucket:",
      Contents.map((file) => file.Key)
    );

    return Contents;
  } catch (error) {
    console.error("List files failed:", error);
  }
}

(async () => {
  const filePath = path.resolve(argv._[0]);
  const filename = path.basename(filePath);

  console.log("checking for", filePath, "existence");

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File "${filename}" does not exist.`);
    process.exit(1);
  }

  const fileStream = fs.createReadStream(filePath);

  try {
    console.log(`Uploading file: ${filename}...`);
    const data = await uploadUnknownLengthStreamObject(fileStream, filename); // important data: data.VersionId, data.Key, data.Location
    console.log("Upload successful!", data);

    // If --delete-after-upload (-d) option is provided, delete the file
    if (argv[ArgsList.DELETE]) {
      console.log(`Deleting file: ${filename}...`);
      await fs.promises.unlink(filePath);
      console.log("File deleted successfully.");
    }
  } catch (error) {
    console.error("Error during upload:", error);
  }
})();
