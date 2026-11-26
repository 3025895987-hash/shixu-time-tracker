import type { Metadata,Viewport } from "next";
export const metadata:Metadata={title:"时序 · 每日工作与学习",description:"工作与学习时长记录",manifest:"/manifest.webmanifest",icons:{icon:"/mark.svg",apple:"/icon-192.png"}};
export const viewport:Viewport={width:"device-width",initialScale:1,themeColor:"#101319"};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><head><link rel="stylesheet" href="/desk.css"/></head><body>{children}</body></html>}