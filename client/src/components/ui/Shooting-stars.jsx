"use client";
import React, { useEffect, useState, useRef } from "react";

const COLORS = ["#2EB9DF", "#9E00FF", "#FF0055"];

// This function now generates a start and end point for a full screen journey
const getRandomTrajectory = () => {
  const side = Math.floor(Math.random() * 4);
  let start = { x: 0, y: 0 };
  let end = { x: 0, y: 0 };

  if (side % 2 === 0) { // Top or Bottom edge
    start.x = Math.random() * window.innerWidth;
    end.x = Math.random() * window.innerWidth;
    start.y = side === 0 ? -20 : window.innerHeight + 20;
    end.y = side === 0 ? window.innerHeight + 20 : -20;
  } else { // Left or Right edge
    start.y = Math.random() * window.innerHeight;
    end.y = Math.random() * window.innerHeight;
    start.x = side === 1 ? -20 : window.innerWidth + 20;
    end.x = side === 1 ? window.innerWidth + 20 : -20;
  }
  
  return { start, end };
};

export const ShootingStars = ({
  duration = 5000,   // Time in ms for one star to travel
  delay = 3000,      // Time in ms to wait before a new star appears
  maxStarSize = 3,   // The final size of the star
  maxTrailLength = 200,
}) => {
  const [star, setStar] = useState(null);

  useEffect(() => {
    const createStar = () => {
      const { start, end } = getRandomTrajectory();
      const newStar = {
        id: Date.now(),
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
        startTime: Date.now(),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      };
      setStar(newStar);
      setTimeout(() => setStar(null), duration); // Remove the star after its journey
      setTimeout(createStar, duration + delay); // Create the next star after a delay
    };

    const initialTimeout = setTimeout(createStar, delay);
    return () => clearTimeout(initialTimeout);
  }, [duration, delay]);

  useEffect(() => {
    const moveStar = () => {
      if (star) {
        setStar(prevStar => {
          if (!prevStar) return null;
          const progress = (Date.now() - prevStar.startTime) / duration;
          if (progress >= 1) return prevStar; // Let the timeout handle removal

          const currentX = prevStar.startX + (prevStar.endX - prevStar.startX) * progress;
          const currentY = prevStar.startY + (prevStar.endY - prevStar.startY) * progress;

          // Scale effect: grow from 0 to 1 in the first half, shrink from 1 to 0 in the second
          const scale = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
          
          return { ...prevStar, x: currentX, y: currentY, scale: scale };
        });
      }
      requestAnimationFrame(moveStar);
    };

    const animationFrame = requestAnimationFrame(moveStar);
    return () => cancelAnimationFrame(animationFrame);
  }, [star, duration]);

  return (
    <svg className="fullscreen-canvas" style={{ zIndex: 1 }}>
      {star && (
        <React.Fragment>
          <defs>
            <linearGradient id={`star-trail-${star.id}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={star.color} stopOpacity="0" />
              <stop offset="100%" stopColor={star.color} stopOpacity="1" />
            </linearGradient>
          </defs>
          <rect
            x={star.x}
            y={star.y}
            width={maxTrailLength * star.scale} // Trail grows and shrinks
            height={maxStarSize * star.scale}   // Star grows and shrinks
            fill={`url(#star-trail-${star.id})`}
            transform={`rotate(${Math.atan2(star.endY - star.startY, star.endX - star.startX) * 180 / Math.PI}, ${star.x}, ${star.y})`}
          />
        </React.Fragment>
      )}
    </svg>
  );
};