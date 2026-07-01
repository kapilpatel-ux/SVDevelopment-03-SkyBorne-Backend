let awsSdk: any = null;
let presigner: any = null;

const loadAwsSdk = () => {
  if (!awsSdk) {
    try {
      awsSdk = require("@aws-sdk/client-s3");
    } catch (error) {
      throw new Error("AWS S3 SDK is not installed. Install @aws-sdk/client-s3 to enable product uploads.");
    }
  }

  if (!presigner) {
    try {
      presigner = require("@aws-sdk/s3-request-presigner");
    } catch (error) {
      throw new Error("AWS S3 presigner SDK is not installed. Install @aws-sdk/s3-request-presigner to enable upload URLs.");
    }
  }

  return {
    S3Client: awsSdk.S3Client,
    PutObjectCommand: awsSdk.PutObjectCommand,
    getSignedUrl: presigner.getSignedUrl,
  };
};

const createS3Client = () => {
  const { S3Client } = loadAwsSdk();

  return new S3Client({
    region: process.env.AWS_REGION!,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY!,
      secretAccessKey: process.env.AWS_SECRET_KEY!,
    },
  });
};

export async function getUploadUrl(fileName: string, fileType: string) {
  const { PutObjectCommand, getSignedUrl } = loadAwsSdk();
  const s3 = createS3Client();

  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET!,
    Key: `products/${Date.now()}-${fileName}`,
    ContentType: fileType,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 60 });

  return uploadUrl;
}

export async function uploadBase64Image(imageBase64: string): Promise<string> {
  const { PutObjectCommand } = loadAwsSdk();
  const s3 = createS3Client();

  const matches = imageBase64.match(/^data:(.+);base64,(.+)$/);
  if (!matches) {
    throw new Error("Invalid imageBase64 format");
  }

  const mimeType = matches[1];
  const base64Data = matches[2];
  const buffer = Buffer.from(base64Data, "base64");
  const ext = mimeType.split("/")[1] || "jpg";
  const key = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    }),
  );

  return `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}
