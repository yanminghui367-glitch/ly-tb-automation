// Standard template uploads include current source files only, never archives.
export function templateRelativeFile(file){return (file.webkitRelativePath||file.name).replaceAll('\\','/').split('/').slice(file.webkitRelativePath?1:0).join('/');}
export function isTemplateSource(path){return path==='商品资料.xlsx'||/^(主图|副图\/[AB]|详情首页|详情正文)\/[^/]+\.(png|jpe?g|webp)$/i.test(path);}
export function templateUploadFiles(files){return Array.from(files).filter(file=>isTemplateSource(templateRelativeFile(file)));}
