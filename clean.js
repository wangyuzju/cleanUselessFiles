#!/usr/bin/node
var fs = require('fs');
var exec = require('child_process').exec;
var STATISTICS = {
  start: new Date(),
  find: 0,
  matched: 0,
  deleted: 0
}

var USER_CONFIG = {
  //rootPath: './',
  //线上环境引用前缀，默认为空，比如音乐盒项目在线上的引用为/player/static/js/naga/asyncmodules/uniqueplay.js，则前缀为/player
  sourceCodePrefix: '/player',
  sourceCodePath: 'src',
  imagesPath: 'src/static/images',
  debug: true
}

/**
 * 配置文件
 */
var CONFIG = {
  pathPrefix: USER_CONFIG.sourceCodePrefix || '',
  rootPath: USER_CONFIG.rootPath,
  //控制是否真的删除
  debug: USER_CONFIG.debug,
  //默认处理文件类型
  fileType: 'images',
  //是否执行grep进行严格验证
  safe: true,
  //根据后缀确定文件类型
  isFileType: function( ext, ft){
    switch (ft) {
      case 'js':
        return !!(ext == ft);
        break;
      case 'images':
        return ext != 'php';
        break;
    }
  }
};


/**
 * 处理传入的参数，确定需要处理的文件类型
 */
process.argv.forEach(function (val, index, array) {
  switch (val) {
    case 'js':
    case 'images':
      CONFIG.fileType = val;
      break;
  }
});


/**
 * 通过.svn目录来自动确定项目根目录
 */
function findProjectRoot() {
  if(CONFIG.rootPath){
    return CONFIG.rootPath;
  }
  var rootPath = '';

  for (var i = 0, l = process.argv[1].split('/').length; i < l; i++) {
    try {
      var res = fs.statSync(rootPath + '.svn').isDirectory();
      if (res) {
        return rootPath ? rootPath : './';
      } else {
        throw new Error('不是svn根目录');
      }
    } catch (e) {
      rootPath = rootPath ? rootPath + '../' : '../';
    }
  }
  throw new Error('请将脚本放到项目下的任意位置，并设定好图片，js文件的路径')
}

CONFIG.rootPath = findProjectRoot();
CONFIG.filePath = {
  'images': CONFIG.rootPath + USER_CONFIG.imagesPath,
  'js': CONFIG.rootPath + USER_CONFIG.sourceCodePath
};
CONFIG.sourceCodePath = CONFIG.rootPath + USER_CONFIG.sourceCodePath;


/**
 * 解析并处理css文件脚本
 */
var fileHandler = {
  _pattens: {
    //识别 ("/static/images")
    'images': /[\("']\/static\/images\/([\w\.\/-]*?)[\)"']/g,
    'js': new RegExp('src=\\\\?"' + CONFIG.pathPrefix.replace('/','\\/') + '\\/([\\w\\/\\.-]*\\.js)', 'g')
    ///src=\\?"\/([\w\/\.-]*\.js)/g
  },
  _fn: null,
  fileMatched: function (fn) {
    this._fn = function (_match, p1) {
      fn(p1);
    };
  },
  process: function (path, type) {
    var data = fs.readFileSync(path, 'utf-8');
    if (!this._pattens[type]) {
      throw new Error('无法找到' + type + '的适配模式');
    }
    data.replace(this._pattens[type], this._fn);
  }
};


/**
 * 编历指定目录，找到某类型的所有文件
 * @param obj
 * @param pathName
 * @param fileType
 */
function loadFileList(obj, pathName, fileType) {
  fileType = fileType ? arguments.callee.filetype = fileType : arguments.callee.filetype;
  var files,
    _fN;

  try {
    files = fs.readdirSync(pathName);
  } catch (e) {
    //该路径不是文件夹，无法打开
    return;
  }

  for (var _i = 0, _l = files.length; _i < _l; _i++) {
    _fN = files[_i].split('.');

    if (_fN.length >= 2 && CONFIG.isFileType(_fN[_fN.length - 1], fileType)) {
      obj[pathName + '/' + _fN.join('.')] = 1;
      STATISTICS.find++;
    } else if (_fN.length == 1) {
      loadFileList(obj, pathName + '/' + files[_i]);
    }
  }
}


/**
 * 遍历所有源文件，找出依赖的文件
 * @param path
 * @param fileType
 */
function walkThroughSourceFiles(path, fileType) {
  /*记住第一次传入的参数，避免递归调用时仍然需要传入参数的问题*/
  fileType = fileType ? arguments.callee.filetype = fileType : arguments.callee.filetype;
  var files,
    _fN;

  try {
    files = fs.readdirSync(path);
  } catch (e) {
    return;
  }

  for (var i = 0, l = files.length; i < l; i++) {
    _fN = files[i].split('.');
    if (_fN.length >= 2 /*&& _fN[1] == 'css'*/) {
      fileHandler.process(path + '/' + files[i], fileType);
    } else if (_fN.length == 1) {
      /*文件夹，递归*/
      walkThroughSourceFiles(path + '/' + files[i]);
    }
  }

}


/**
 * 将对象的key转换成数组，便于最终统计数量
 * @param obj
 * @returns {Array}
 */
function plainObjToArray(obj) {
  var result = [];
  for (var key in obj) {
    if (obj.hasOwnProperty(key)) {
      result.push(key);
    }
  }
  return result;
}


/**
 * nodejs 默认的exec是异步的，调用过多exec会导致抛出 Error: spawn EMFILE (经过测试是300个以上)，
 * 需要实现一个将异步调用变成同步调用的堆栈。
 * @type {{processing: boolean, count: number, cmd: Array, fn: Array, process: Function, stop: Function}}
 */
var stack = {
  processing: false,
  count: 0,
  cmd: [],
  fn: [],
  process: function () {
    if (this.count) {
      var cmd = stack.cmd.shift();
      exec(cmd, function (error, stdout, stderr) {
        stack.fn.shift().call(this, error, stdout, stderr);
        stack.count--;
        stack.process();
      });
    } else {
      this.stop();
      this.processing = false;
    }
  },
  //最后需要执行的函数，例如输出总执行时间
  _callList: [],
  finally: function (fn) {
    this._callList.push(fn);
  },
  stop: function () {
    for (var i = 0, l = this._callList.length; i < l; i++) {
      (this._callList.shift())();
    }
  }
};


function execSync(cmd, fn) {
  stack.count++;
  stack.cmd.push(cmd);
  stack.fn.push(fn);
  if (!stack.processing) {
    stack.processing = true;
    stack.process();
  }
}


/**
 * 删除传入的数组所表示的文件
 * @param fileList
 */
function deleteFiles(fileList) {
  //grep时候要用部署到web上的根目录环境，而不是项目的相对路径，比如去掉前缀('./src/static');
  var prefixForGrep = CONFIG.sourceCodePath.length;


  for (var i = 0, l = fileList.length; i < l; i++) {
    var fp = fileList[i];

    if (CONFIG.safe) {
      //安全删除模式，找到需要删除的文件列表之后再grep确认一下
      var cmd = 'grep ' + fp.slice(prefixForGrep) + ' ' + CONFIG.sourceCodePath + ' -r';
      execSync(cmd, (function (fileName) {
        return (function (error, stdout, stderr) {
          if (error && error.code == 1) {
            //grep 无法找到结果 返回code为1的error
            console.log('删除：' + fileName);
            STATISTICS.deleted++;
            if (!CONFIG.debug) {
              try {
                fs.unlinkSync(fileName);
              } catch (e) {
                console.log('无法删除：' + fileName + e);
              }
            }
          } else if (stdout) {
            console.log("!!!!! " + fileName + " **可能** 被以下文件调用：");
            console.log(stdout + '>>>>>>>>>>>>>>');
          }
        });
      })(fp));
    } else {
      //直接删除模式，对正则没有匹配到的文件进行直接删除
      if(!CONFIG.debug){
        try {
          fs.unlinkSync(fp);
          console.log('删除：' + fp);
          STATISTICS.deleted ++;
        }catch (e){
          console.log('!!!!!删除失败' + e);
        }
      }else{
        console.log('删除：' + fp);
        STATISTICS.deleted ++;
      }
    }
  }

  stack.finally(function () {
    //非调试模式下，有文件被删除，更新svn状态
    if (STATISTICS.deleted > 0 && !CONFIG.debug) {
      /*将文件从svn中移除*/
      exec("svn st | grep '^!' | awk '{print $2}' | xargs svn delete --force", {cwd: CONFIG.rootPath},
        function (error, stdout, stderr) {
          //stdout ? console.log(stdout) : '';
          stderr ? console.log('stderr: ' + stderr) : '';
          if (error !== null) {
            console.log('exec error: ' + error);
          }
        });
    }

    console.log('============= 运行结果(执行时间' + (new Date() - STATISTICS.start) + 'ms) ==============')
    console.log('共找到' + (STATISTICS.find - STATISTICS.matched) + '个垃圾文件(共' + STATISTICS.find + '个文件)');
    console.log('安全删除' + STATISTICS.deleted + '个文件，剩余' +
      (STATISTICS.find - STATISTICS.matched - STATISTICS.deleted) + '个文件可能被使用到，请确认是否不再需要，手动进行清理');
  });
}


(function clearFiles(filetype) {
  try{
    fs.statSync(CONFIG.filePath[filetype]).isDirectory()
  }catch (e){
    console.log('请检查设置的项目根路径和源代码路径，无法找到'+ CONFIG.filePath[filetype]);
  }
  var dustbin = {};

  //找到项目中同类型的所有文件
  loadFileList(dustbin, CONFIG.filePath[filetype], filetype);

  //去除匹配到的项目中用到的文件
  fileHandler.fileMatched(function (filename) {
    var filePath = CONFIG.filePath[filetype] + '/' + filename;
    dustbin[filePath] ? STATISTICS.matched++ : '';
    delete dustbin[filePath];
  });

  try {
    walkThroughSourceFiles(CONFIG.sourceCodePath, filetype);
  } catch (e) {
    //捕获没有设定匹配模式的文件类型，防止出错
    console.log(e);
    return;
  }

  //删除操作
  deleteFiles(plainObjToArray(dustbin));

})(CONFIG.fileType);