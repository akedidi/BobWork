window.bobPointerClick = () => {
  const pointer = document.getElementById('pointer')
  pointer.classList.remove('click')
  void pointer.offsetWidth
  pointer.classList.add('click')
}

window.bobPointerRetarget = () => {
  const pointer = document.getElementById('pointer')
  pointer.classList.remove('retarget')
  void pointer.offsetWidth
  pointer.classList.add('retarget')
}
