Theme used: [@import url("https://cdn.jsdelivr.net/gh/tedhinklater/finimalism@latest/finimalism10.11-black.css");](https://github.com/tedhinklater/finimalism)

current custom css code in jellyfin:

```css
@import url("https://cdn.jsdelivr.net/gh/tedhinklater/finimalism@latest/finimalism10.11-black.css");

/* Fix for Jellyseerr icon blown up by Finimalism theme */
.verticalSection .card img.jellyseerr-icon-on-card {
    width: 18% !important;
    height: auto !important;
}

#overlay-disc {
  position: absolute !important;  
  top: calc(50vh - (26vw / 2)) !important;
  right: 7% !important;
  width: 26vw !important;
  height: auto !important;
  display: block !important;
  animation: 30s linear infinite spin !important;
  z-index: -1 !important;
  filter: brightness(80%) !important;
}

#overlay-plot {
  top: 61% !important;
  max-width: 54% !important;
  height: 50vh !important;
  display: block !important;
  right: 41vw !important;
  position: absolute !important;
  font-size: 21px !important;
}

#overlay-logo {
    position: absolute !important;
    max-width: 50vw !important; /* Max width is half the viewport width */
    max-height: 23vh !important; /* Limits the height */
    width: auto !important; /* Ensures no forced stretching */
    height: auto !important; /* Preserves aspect ratio */
    top: 25vh !important; /* Places it at a quarter of the viewport height */
    left: 19vw !important; /* Centers within the left half */
    transform: translateX(-50%) !important; /* Ensures true centering */
    display: block !important;
	margin-left: 12vw !important;
    object-fit: contain; /* Prevents cropping/stretching */
}
```
