import type { CSSProperties } from 'react'

const DEFAULT_SRC =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_083109_283f3553-e28f-428b-a723-d639c617eb2b.mp4'

type Props = {
  src?: string
  /** Distance from the top when `contained` is false. */
  topOffset?: number
  /** Vertical gradient overlay colors. Defaults to a soft white→transparent→white mask. */
  overlayTop?: string
  overlayBottom?: string
  /** If true, position absolutely within the closest positioned parent (fills it). */
  contained?: boolean
  className?: string
  children?: React.ReactNode
}

export function VideoBackground({
  src = DEFAULT_SRC,
  topOffset = 80,
  overlayTop = 'rgba(255,255,255,0.55)',
  overlayBottom = 'rgba(255,255,255,0.85)',
  contained = false,
  className,
  children,
}: Props) {
  const wrapperStyle: CSSProperties = contained
    ? {
        position: 'absolute',
        top: topOffset,
        right: 0,
        bottom: 0,
        left: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
      }
    : {
        position: 'fixed',
        top: topOffset,
        right: 0,
        bottom: 0,
        left: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
      }

  const videoStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  }

  return (
    <div className={className} style={wrapperStyle} data-video-bg>
      <video
        src={src}
        muted
        autoPlay
        loop
        playsInline
        preload="auto"
        style={videoStyle}
      />
      {children}
    </div>
  )
}

export default VideoBackground
