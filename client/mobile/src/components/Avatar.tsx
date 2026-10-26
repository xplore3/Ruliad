/**
 * 陪练员头像组件：
 * - 有 avatar URL 时显示图片
 * - 无图片时使用本地中国人形象照片头像（基于名字确定性选择）
 */

/** 无自定义头像时，按名字哈希从本地中国人形象头像中选择一个 */
const DEFAULT_PHOTOS = [
  '/avatars/woman-1.jpg',
  '/avatars/man-1.jpg',
  '/avatars/woman-2.jpg',
  '/avatars/man-2.jpg',
  '/avatars/woman-3.jpg',
  '/avatars/man-3.jpg',
  '/avatars/woman-4.jpg',
  '/avatars/man-4.jpg',
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function defaultPhoto(name: string): string {
  return DEFAULT_PHOTOS[hashName(name) % DEFAULT_PHOTOS.length];
}

interface AvatarProps {
  name: string;
  avatar?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  rounded?: 'full' | 'xl' | '2xl' | '3xl';
}

const SIZE_MAP = {
  sm: 'h-10 w-10',
  md: 'h-12 w-12',
  lg: 'h-14 w-14',
  xl: 'h-24 w-24',
};

const ROUNDED_MAP = {
  full: 'rounded-full',
  xl: 'rounded-xl',
  '2xl': 'rounded-2xl',
  '3xl': 'rounded-3xl',
};

export function Avatar({ name, avatar, size = 'md', className = '', rounded = 'full' }: AvatarProps) {
  const sizeCls = SIZE_MAP[size];
  const roundedCls = ROUNDED_MAP[rounded];
  const url = avatar || defaultPhoto(name);

  return (
    <div className={`${sizeCls} ${roundedCls} ${className} overflow-hidden`} style={{ backgroundColor: '#2A2D36' }}>
      <img
        src={url}
        alt={name}
        className="h-full w-full object-cover"
        onError={(e) => {
          // 图片加载失败时换一张默认本地头像
          const img = e.currentTarget;
          const fallbackUrl = '/avatars/woman-1.jpg';
          if (img.src !== fallbackUrl) {
            img.src = fallbackUrl;
          }
        }}
      />
    </div>
  );
}
