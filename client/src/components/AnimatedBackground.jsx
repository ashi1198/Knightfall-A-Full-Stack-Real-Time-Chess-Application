import React from "react";
import { ShootingStars } from "./ui/Shooting-stars";
import { StarsBackground } from "./ui/Stars-background";

export function AnimatedBackground() {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: -1, // This is the key to keeping it in the background
        backgroundColor: '#000' // A solid black fallback color
      }}
    >
         <ShootingStars
          starCount={1} 
          duration={2000}     // Total stars on screen at once
  minSpeed={3}
  maxSpeed={7}
  minDelay={30000}     // <-- Increased from 1500
  maxDelay={30000}     // <-- Increased from 3000

      />
      <StarsBackground />
    </div>
  );
}