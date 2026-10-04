Deploy loop (after code changes)
cd /home/root/mothercare-backend
git pull
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
mkdir -p dist/src/admin && cp src/admin/index.html dist/src/admin/
pm2 restart mcs-backend --update-env
curl -s https://api.yourdomain.com/health