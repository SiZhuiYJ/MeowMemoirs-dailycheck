import { getVideoFileMetadata } from "./videoMetadata";

export async function getVideoDuration(file: File): Promise<number | null> {
  const metadata = await getVideoFileMetadata(file);
  return metadata.duration;
}
