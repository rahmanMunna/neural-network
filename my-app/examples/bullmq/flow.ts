import { FlowProducer } from "bullmq";
import { connection } from "./connection.js";

// #region flow
const flows = new FlowProducer({ connection });

/**
 * A flow is a tree of jobs. Parents wait until all their children finish, so
 * here "publish" only runs once every size has been resized.
 */
export function processVideo(videoId: string) {
  return flows.add({
    name: "publish",
    queueName: "video",
    data: { videoId },
    children: [
      { name: "resize", queueName: "video-resize", data: { videoId, height: 480 } },
      { name: "resize", queueName: "video-resize", data: { videoId, height: 1080 } },
    ],
  });
}
// #endregion

export const closeFlows = () => flows.close();
