import React from 'react';

const LiveStream = () => (
  <div className="my-8">
    <h2 className="text-lg font-semibold mb-2">Live Camera Stream</h2>
    <img
      src="http://localhost:8001/video_feed"
      alt="Live Stream"
      style={{ width: '100%', borderRadius: 8, maxHeight: 400, objectFit: 'contain' }}
    />
  </div>
);

export default LiveStream;