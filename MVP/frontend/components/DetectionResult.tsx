"use client";

import React, { useEffect, useState } from 'react';

const DetectionResult = () => {
  const [imgUrl, setImgUrl] = useState('http://localhost:8001/latest_detection');

  useEffect(() => {
    const interval = setInterval(() => {
      setImgUrl(`http://localhost:8001/latest_detection?${Date.now()}`);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="my-8">
      <h2 className="text-lg font-semibold mb-2">Latest Mess Detection</h2>
      <img
        src={imgUrl}
        alt="Detection"
        style={{ width: '100%', borderRadius: 8, maxHeight: 400, objectFit: 'contain' }}
      />
    </div>
  );
};

export default DetectionResult;