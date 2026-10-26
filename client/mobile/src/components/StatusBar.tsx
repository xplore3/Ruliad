/** 顶部状态栏（模拟手机状态栏） */
export default function StatusBar({ dark = true }: { dark?: boolean }) {
  const textColor = dark ? '#F7F7FA' : '#17191F';
  const subColor = dark ? '#A4A7B3' : '#A4A7B3';
  return (
    <div className="flex items-center justify-between px-5 pt-10 pb-1 text-xs font-medium safe-top" style={{ color: textColor }}>
      <span>Grasp</span>
      <div className="flex items-center gap-1.5">
        <span style={{ color: subColor }}>你的专属陪练员与指导参谋</span>
        <svg className="h-3.5 w-3.5" style={{ color: subColor }} fill="currentColor" viewBox="0 0 24 24">
          <path d="M2 22h20V2L2 22z" fillOpacity="0.3" />
          <path d="M2 22h4V10L2 14v8z" />
        </svg>
      </div>
    </div>
  );
}
