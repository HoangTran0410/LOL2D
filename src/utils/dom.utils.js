export const preventRightClick = element => {
  element.addEventListener('contextmenu', event => event.preventDefault());
};

export function goFullscreen() {
  let element = document.documentElement; // Get the root element of the document
  if (element.requestFullscreen) {
    element.requestFullscreen(); // Standard
  } else if (element.mozRequestFullScreen) {
    element.mozRequestFullScreen(); // Firefox
  } else if (element.webkitRequestFullscreen) {
    element.webkitRequestFullscreen(); // Chrome, Safari, and Opera
  } else if (element.msRequestFullscreen) {
    element.msRequestFullscreen(); // Internet Explorer and Edge
  }
}

export function exitFullscreen() {
  if (document.exitFullscreen) {
    document.exitFullscreen(); // Standard
  } else if (document.mozCancelFullScreen) {
    document.mozCancelFullScreen(); // Firefox
  } else if (document.webkitExitFullscreen) {
    document.webkitExitFullscreen(); // Chrome, Safari and Opera
  } else if (document.msExitFullscreen) {
    document.msExitFullscreen(); // Internet Explorer and Edge
  }
}

export function toggleFullscreen() {
  if (document.fullscreenElement) {
    exitFullscreen();
    return false;
  } else {
    goFullscreen();
    return true;
  }
}
