from PIL import Image, ImageDraw, ImageFont
import colorsys, json, os
W,H=3200,800
def font(sz):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf","/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"]:
        if os.path.exists(p): return ImageFont.truetype(p,sz)
    return ImageFont.load_default(sz)
F=font(64); FS=font(40)
def char(d,cx,base,kind,col):
    # simple silhouettes, varied
    hr=[55,70,45,60,80,50,65,58][kind%8]
    bw=[110,150,90,170,120,200,100,140][kind%8]
    bh=[300,260,340,230,280,220,320,270][kind%8]
    top=base-bh
    if kind%3==0: d.rounded_rectangle([cx-bw//2,top,cx+bw//2,base],radius=40,fill=col)
    elif kind%3==1: d.polygon([(cx,top-10),(cx-bw//2-20,base),(cx+bw//2+20,base)],fill=col)
    else: d.ellipse([cx-bw//2,top,cx+bw//2,base+20],fill=col)
    hy=top-hr+10
    d.ellipse([cx-hr,hy-hr,cx+hr,hy+hr],fill=col)
    if kind%4==0: d.polygon([(cx-hr,hy-hr//2),(cx-hr-10,hy-hr-60),(cx-hr//3,hy-hr+5)],fill=col); d.polygon([(cx+hr,hy-hr//2),(cx+hr+10,hy-hr-60),(cx+hr//3,hy-hr+5)],fill=col)
    if kind%4==1: d.rectangle([cx-hr-20,hy-hr-20,cx+hr+20,hy-hr+5],fill=col); d.rectangle([cx-hr//2,hy-hr-90,cx+hr//2,hy-hr],fill=col)
    if kind%4==2: d.line([(cx+bw//2,top+40),(cx+bw//2+90,top-80)],fill=col,width=18)
    for s in (-1,1): d.ellipse([cx+s*hr//2-9,hy-12,cx+s*hr//2+9,hy+6],fill=(15,15,20))
cfg=[]
for ci,n in enumerate([8,7,8],1):
    im=Image.new("RGB",(W,H),(28,30,38)); d=ImageDraw.Draw(im)
    cw=W/n
    for i in range(n):
        x0=int(i*cw)
        if i: d.line([(x0,40),(x0,H-40)],fill=(50,53,64),width=3)
        h=((ci*0.17)+i/n)%1
        col=tuple(int(c*255) for c in colorsys.hsv_to_rgb(h,0.55,0.9))
        cx=int(x0+cw/2)
        char(d,cx,H-150,i+ci*3,col)
        t=str(i+1); bb=d.textbbox((0,0),t,font=F)
        d.text((cx-(bb[2]-bb[0])/2,H-120),t,font=F,fill=(240,240,245))
    d.text((30,20),f"SAMPLE · Collage {ci} · {n} options",font=FS,fill=(255,200,80))
    bb=d.textbbox((0,0),"SAMPLE",font=FS); d.text((W-40-(bb[2]-bb[0]),20),"SAMPLE",font=FS,fill=(255,200,80))
    fn=f"collage-{ci}.png"; im.save(f"projects/demo/{fn}",optimize=False)
    cfg.append({"file":fn,"options":n,"label":f"Collage {ci}"})
json.dump({"title":"Demo Project (Sample)","description":"Sample collages to preview how picking works.","collages":cfg},open("projects/demo/project.json","w"),indent=2)
json.dump({"projects":[{"slug":"demo","title":"Demo Project (Sample)","description":"Sample collages to preview how picking works."}]},open("projects/projects.json","w"),indent=2)
