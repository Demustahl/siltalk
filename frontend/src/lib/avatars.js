export const PRESET_AVATARS = [
  { id: "ava-alien", label: "Alien", src: "/avatars/ava-alien.png" },
  { id: "ava-cat", label: "Cat", src: "/avatars/ava-cat.png" },
  { id: "ava-dog", label: "Dog", src: "/avatars/ava-dog.png" },
  { id: "ava-fox", label: "Fox", src: "/avatars/ava-fox.png" },
  { id: "ava-panda", label: "Panda", src: "/avatars/ava-panda.png" },
  { id: "ava-robot", label: "Robot", src: "/avatars/ava-robot.png" },
];

export function getPresetAvatarSrc(avatarId) {
  return PRESET_AVATARS.find((avatar) => avatar.id === avatarId)?.src || "";
}
