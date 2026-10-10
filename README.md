все 40000 значений объектов http://localhost:3000/api/requirements
невалид http://localhost:3000/api/invalid
архив http://localhost:3000/api/archive?object=src1_obj0002&source=1
тренд http://localhost:3000/api/trends?name=src1_obj0001
для запуска системы 
node scripts/generate-config.js
node scripts/seed-metadata.js
node src/index.js
очистить бд
Remove-Item data\param.db*
node scripts/seed-metadata.js
