import compression from "compression";

export const clinicalCompression = compression({
  threshold: 1024, level: 1,
  filter: (req, res) => req.method === "GET" &&
    /^\/api\/(appointments(?:\/queue)?|assistant\/(queues|appointments|daily-income)|doctor\/dashboard)$/.test(req.path) &&
    compression.filter(req, res),
});
