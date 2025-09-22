"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";

export const StarsBackground = () => {
  const canvasRef = useRef(null);

  const random = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  const generateStars = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Generate 300 smaller stars
    for (let i = 0; i < 300; i++) {
      const x = random(0, canvas.width);
      const y = random(0, canvas.height);
      // Make radius smaller (0.5 to 1.5 pixels)
      const radius = (random(5, 15) / 10); 
      const opacity = random(20, 80) / 100;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
      ctx.fill();
    }
  }, []);

  useEffect(() => {
    generateStars();
    window.addEventListener("resize", generateStars);
    return () => window.removeEventListener("resize", generateStars);
  }, [generateStars]);

  return (
    <div className="fullscreen-canvas">
      <canvas ref={canvasRef} id="stars" style={{ width: '100%', height: '100%' }} />
    </div>
  );
};